const WORD_LEAD_IN_SECONDS = 0.1
const WORD_TAIL_OUT_SECONDS = 0.12

export function createReaderWordAudio({ getMedia, onError = () => {} }) {
  let active = null

  function cancel() {
    if (!active) return
    clearTimeout(active.timer)
    for (const [event, handler] of active.listeners) active.media.removeEventListener(event, handler)
    active = null
  }

  async function play(word) {
    cancel()
    const media = getMedia()
    const wordStart = word?.start == null ? NaN : Number(word.start)
    const wordEnd = word?.end == null ? NaN : Number(word.end)
    if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd) || wordStart < 0 || wordEnd <= wordStart
      || (Number.isFinite(media?.duration) && wordStart >= media.duration)) {
      onError('该词缺少有效的时间范围，暂时无法播放原声。')
      return false
    }
    const source = media?.currentSrc || media?.src
    if (!source) {
      onError('请先加载当前材料的音频，再点击标注词播放原声。')
      return false
    }
    // Alignment boundaries can omit consonant onsets/tails. Use the available
    // inter-word gap, without extending into the neighbouring timestamp ranges.
    const previousEnd = word?.previousEnd == null ? NaN : Number(word.previousEnd)
    const nextStart = word?.nextStart == null ? NaN : Number(word.nextStart)
    const start = Math.max(0, wordStart - WORD_LEAD_IN_SECONDS,
      Number.isFinite(previousEnd) ? Math.min(wordStart, previousEnd) : 0)
    const end = Math.min(wordEnd + WORD_TAIL_OUT_SECONDS,
      Number.isFinite(nextStart) ? Math.max(wordEnd, nextStart) : Infinity,
      Number.isFinite(media.duration) ? media.duration : Infinity)
    const clip = { media, source, timer: null, listeners: [] }
    active = clip
    let awaitingOwnSeek = Boolean(media.seeking)

    function listen(event, handler) {
      media.addEventListener(event, handler)
      clip.listeners.push([event, handler])
    }

    function checkEnd() {
      if (active !== clip) return
      if (media.seeking) {
        if (!awaitingOwnSeek || media.currentTime < start - 0.01 || media.currentTime >= end) cancel()
        return
      }
      if (getMedia() !== media || (media.currentSrc || media.src) !== source) {
        cancel()
      } else if (media.currentTime >= end) {
        cancel()
        media.pause()
      }
    }

    function poll() {
      checkEnd()
      if (active !== clip) return
      const remainingMs = (end - media.currentTime) * 1000 / (media.playbackRate || 1)
      clip.timer = setTimeout(poll, Math.max(1, Math.min(25, remainingMs)))
    }

    listen('timeupdate', checkEnd)
    listen('seeking', () => {
      if (!awaitingOwnSeek || media.currentTime < start - 0.01 || media.currentTime >= end) cancel()
    })
    listen('seeked', () => {
      awaitingOwnSeek = false
      checkEnd()
    })
    listen('pause', () => { if (media.paused) cancel() })
    listen('ended', cancel)
    listen('emptied', cancel)
    listen('error', () => {
      cancel()
      onError('原声播放失败，请重新加载当前材料后重试。')
    })
    try {
      if (media.currentTime !== start) {
        awaitingOwnSeek = true
        media.currentTime = start
      }
      await media.play()
      if (active !== clip) return false
      awaitingOwnSeek = false
      poll()
      return true
    } catch (error) {
      if (active !== clip) return false
      cancel()
      onError('原声播放失败，请点击音频播放按钮后重试。')
      return false
    }
  }

  return { play, cancel }
}

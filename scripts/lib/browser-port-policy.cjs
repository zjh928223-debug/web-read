const CHROMIUM_UNSAFE_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
])

// Keep both the legacy reader pair and the current daily-production pair out
// of browser-owned ephemeral allocation.  The production launcher may use the
// current pair only after its explicit daily-production authorization path.
const RESERVED_DAILY_PORTS = new Set([5173, 8765, 5174, 8766])

function isBrowserSafePort(port) {
  const numericPort = Number(port)
  return Number.isInteger(numericPort)
    && numericPort >= 1024
    && numericPort <= 65535
    && !CHROMIUM_UNSAFE_PORTS.has(numericPort)
    && !RESERVED_DAILY_PORTS.has(numericPort)
}

function listenOnBrowserSafePort(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const listen = () => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(0, host, () => {
        server.removeListener('error', onError)
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        if (isBrowserSafePort(port)) return resolve(port)
        server.close((error) => {
          if (error) return reject(error)
          listen()
        })
      })
    }
    listen()
  })
}

module.exports = {
  isBrowserSafePort,
  listenOnBrowserSafePort,
  RESERVED_DAILY_PORTS,
}

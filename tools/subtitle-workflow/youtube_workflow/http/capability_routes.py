from fastapi import APIRouter
from fastapi.responses import FileResponse

def create_capability_router(manager, *, dependency_overrides_provider=None):
    router = APIRouter(dependency_overrides_provider=dependency_overrides_provider)
    @router.get("/api/dictionary/pronunciation")
    def dictionary_pronunciation(word: str = ""):
        return manager.merriam_pronunciation(word)

    @router.post("/api/dictionary/pronunciations")
    def dictionary_pronunciations(payload: dict):
        return manager.merriam_pronunciations(payload)

    @router.get("/api/dictionary/pronunciation/status")
    def dictionary_pronunciation_status():
        return manager.merriam_pronunciation_status()

    @router.post("/api/dictionary/general-meanings")
    def dictionary_general_meanings(payload: dict):
        return manager.merriam_general_meanings(payload)

    @router.post("/api/tts/edge")
    def edge_tts_pronunciation(payload: dict):
        return manager.edge_tts_pronunciation((payload or {}).get("text"))

    @router.post("/api/tts/edge/batch")
    def edge_tts_pronunciations(payload: dict):
        return manager.edge_tts_pronunciations(payload)

    @router.get("/api/tts/edge/audio/{cache_id}.mp3")
    def edge_tts_audio(cache_id: str):
        return FileResponse(manager.edge_tts_audio_path(cache_id), media_type="audio/mpeg")

    @router.get("/api/tts/edge/status")
    def edge_tts_status():
        return manager.edge_tts_status()

    return router

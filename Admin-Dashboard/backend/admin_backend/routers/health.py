from fastapi import APIRouter

router = APIRouter()


@router.get("/api/dashboard/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "ekalaiva-dashboard"}

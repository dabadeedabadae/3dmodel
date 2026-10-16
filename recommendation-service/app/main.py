"""Phase 2 scaffold. Recommendation logic is intentionally not implemented yet."""
from fastapi import FastAPI, HTTPException

from app.models.schemas import RecommendationRequest, RecommendationResponse

app = FastAPI(title="FitCast Recommendation Service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/recommendations", response_model=RecommendationResponse,
          responses={501: {"description": "Recommendation engine is not implemented yet"}})
def recommendations(request: RecommendationRequest):
    raise HTTPException(status_code=501, detail="Recommendation engine is not implemented yet")

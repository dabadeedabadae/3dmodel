"""FitCast recommendation service: rules v1 (app/engine), no machine learning."""
from fastapi import FastAPI

from app.engine.recommend import recommend
from app.models.schemas import RecommendationRequest, RecommendationResponse

app = FastAPI(title="FitCast Recommendation Service", version="0.2.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/recommendations", response_model=RecommendationResponse)
def recommendations(request: RecommendationRequest):
    return recommend(request)

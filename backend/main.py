import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.mongo import close_mongo, connect_mongo
from routers import devices, roster
from routers import tutor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("omnitwin")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_mongo()
    log.info("[OmniTwin] Backend started")
    yield
    await close_mongo()
    log.info("[OmniTwin] Backend stopped")


app = FastAPI(title="OmniTwin API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router, prefix="/devices", tags=["devices"])
app.include_router(roster.router,  tags=["roster"])
app.include_router(tutor.router,   prefix="/tutor",  tags=["tutor"])


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok"}
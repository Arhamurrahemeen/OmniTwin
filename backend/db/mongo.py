import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import settings

log = logging.getLogger("twinlab.mongo")

_client: AsyncIOMotorClient = None


async def connect_mongo():
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    log.info("[Mongo] Connected")


async def close_mongo():
    if _client:
        _client.close()
        log.info("[Mongo] Disconnected")


def get_db() -> AsyncIOMotorDatabase:
    return _client[settings.mongo_db]

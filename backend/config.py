from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongo_uri: str = "mongodb://admin:twinlab123@localhost:27017"
    mongo_db: str = "twinlab"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"

    model_config = {"env_file": ".env"}


settings = Settings()
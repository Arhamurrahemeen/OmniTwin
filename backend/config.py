from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    influx_url: str = "http://localhost:8086"
    influx_token: str = "twinlab-super-secret-token"
    influx_org: str = "twinlab"
    influx_bucket: str = "twinlab"
    mongo_uri: str = "mongodb://admin:twinlab123@localhost:27017"
    mongo_db: str = "twinlab"

    model_config = {"env_file": ".env"}


settings = Settings()

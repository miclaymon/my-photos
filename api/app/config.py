from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql://postgres:postgres@localhost:5432/myphotos"

    # Auth
    secret_key: str = "change-me-to-a-random-secret"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # Object storage (RustFS / S3-compatible)
    storage_endpoint: str = "http://localhost:9000"
    storage_access_key_id: str = ""
    storage_secret_access_key: str = ""
    storage_bucket_name: str = "photos"
    storage_region: str = "us-east-1"
    storage_max_versions: int = 3

    # Response cache (SQLite)
    cache_db_path: str = "./response_cache.db"

    # CORS — comma-separated list of allowed origins for the web client and any
    # other clients (e.g. "http://localhost:3000,https://photos.example.com")
    cors_origins_raw: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]


settings = Settings()

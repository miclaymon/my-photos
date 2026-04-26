#!/usr/bin/env python3
"""
One-time database setup script.

Prompts for connection info, creates the database and app user,
runs Alembic migrations, and seeds the first admin account.

Usage:
    python scripts/setup_db.py
"""
import getpass
import os
import secrets
import string
import subprocess
import sys

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


def prompt(label: str, default: str = "", secret: bool = False) -> str:
    display = f"{label} [{default}]: " if default else f"{label}: "
    if secret:
        value = getpass.getpass(display)
    else:
        value = input(display).strip()
    return value or default


def generate_secret(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_db_and_user(
    admin_host: str,
    admin_port: int,
    admin_user: str,
    admin_password: str,
    db_name: str,
    app_user: str,
    app_password: str,
) -> None:
    conn = psycopg2.connect(
        host=admin_host,
        port=admin_port,
        user=admin_user,
        password=admin_password,
        dbname="postgres",
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()

    # Create app user if not exists
    cur.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,)
    )
    if not cur.fetchone():
        cur.execute(
            sql.SQL("CREATE USER {} WITH PASSWORD %s").format(sql.Identifier(app_user)),
            (app_password,),
        )
        print(f"  Created PostgreSQL user: {app_user}")
    else:
        print(f"  User already exists: {app_user}")

    # Create database if not exists
    cur.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)
    )
    if not cur.fetchone():
        cur.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(db_name), sql.Identifier(app_user)
            )
        )
        print(f"  Created database: {db_name}")
    else:
        print(f"  Database already exists: {db_name}")

    cur.execute(
        sql.SQL("GRANT ALL PRIVILEGES ON DATABASE {} TO {}").format(
            sql.Identifier(db_name), sql.Identifier(app_user)
        )
    )
    cur.close()
    conn.close()


def write_env_file(database_url: str, secret_key: str) -> None:
    env_example = os.path.join(os.path.dirname(__file__), "..", ".env.example")
    env_out = os.path.join(os.path.dirname(__file__), "..", ".env")

    with open(env_example) as f:
        content = f.read()

    content = content.replace(
        "DATABASE_URL=postgresql://myphotos:change-me@localhost:5432/myphotos",
        f"DATABASE_URL={database_url}",
    )
    content = content.replace(
        "SECRET_KEY=change-me-to-a-random-secret",
        f"SECRET_KEY={secret_key}",
    )

    with open(env_out, "w") as f:
        f.write(content)
    print(f"  Wrote {env_out}")


def run_migrations() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=os.path.join(os.path.dirname(__file__), ".."),
    )
    if result.returncode != 0:
        print("ERROR: Alembic migration failed.")
        sys.exit(1)
    print("  Migrations applied.")


def seed_admin(database_url: str, email: str, password: str, display_name: str) -> None:
    # Import here so the .env is loaded before app code runs.
    # Add the api/ root to sys.path so `app` is importable regardless of cwd.
    api_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if api_root not in sys.path:
        sys.path.insert(0, api_root)

    os.environ.setdefault("DATABASE_URL", database_url)

    from app.database import SessionLocal
    from app.models.user import User
    from app.auth.password import hash_password
    from app.utils.user_setup import provision_personal_library

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            print(f"  Admin account already exists: {email}")
            return
        admin = User(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name,
            is_admin=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        library = provision_personal_library(db, admin.id, display_name)
        print(f"  Created admin account: {email}")
        print(f"  Created personal library: {library.name} ({library.id})")
    finally:
        db.close()


def main() -> None:
    print("\n=== My Photos — Database Setup ===\n")

    print("PostgreSQL superuser credentials (used only to create the app DB and user):")
    pg_host     = prompt("  Host", "localhost")
    pg_port     = int(prompt("  Port", "5432"))
    pg_admin    = prompt("  Superuser", "postgres")
    pg_password = prompt("  Password", secret=True)

    print("\nApp database settings:")
    db_name      = prompt("  Database name", "myphotos")
    app_user     = prompt("  App DB username", "myphotos")
    app_password = prompt("  App DB password (leave blank to generate)", secret=True)
    if not app_password:
        app_password = generate_secret(24)
        print(f"  Generated password: {app_password}")

    print("\nFirst admin account:")
    admin_email   = prompt("  Email")
    admin_name    = prompt("  Display name", "Admin")
    admin_pass    = prompt("  Password", secret=True)
    if not admin_pass:
        admin_pass = generate_secret(16)
        print(f"  Generated password: {admin_pass}")

    database_url = f"postgresql://{app_user}:{app_password}@{pg_host}:{pg_port}/{db_name}"
    secret_key   = generate_secret(48)

    print("\n[1/4] Creating database and user...")
    create_db_and_user(pg_host, pg_port, pg_admin, pg_password, db_name, app_user, app_password)

    print("[2/4] Writing .env file...")
    write_env_file(database_url, secret_key)

    print("[3/4] Running migrations...")
    run_migrations()

    print("[4/4] Creating admin account...")
    seed_admin(database_url, admin_email, admin_pass, admin_name)

    print("\nSetup complete.\n")
    print(f"  Start the API server with:  uvicorn main:app --reload")
    print(f"  Admin login: {admin_email}\n")


if __name__ == "__main__":
    main()

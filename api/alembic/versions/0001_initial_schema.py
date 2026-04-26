"""Initial schema — all tables

Revision ID: 0001
Revises:
Create Date: 2026-04-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id",            sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("email",         sa.String(255),   nullable=False),
        sa.Column("password_hash", sa.String(255),   nullable=False),
        sa.Column("display_name",  sa.String(255)),
        sa.Column("is_admin",      sa.Boolean(),     nullable=False, server_default="false"),
        sa.Column("created_at",    sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "media",
        sa.Column("id",                   sa.String(36),  primary_key=True),
        sa.Column("uploaded_by",          sa.Integer(),   sa.ForeignKey("users.id"), nullable=False),
        sa.Column("object_key",           sa.Text(),      nullable=False),
        sa.Column("original_filename",    sa.Text(),      nullable=False),
        sa.Column("content_type",         sa.String(100), nullable=False),
        sa.Column("size",                 sa.Integer(),   nullable=False),
        sa.Column("width",                sa.Integer()),
        sa.Column("height",               sa.Integer()),
        sa.Column("aspect_ratio",         sa.Float()),
        sa.Column("duration_seconds",     sa.Float()),
        sa.Column("taken_at",             sa.DateTime(timezone=True)),
        sa.Column("created_at",           sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("thumbnail_object_key", sa.Text()),
        sa.Column("preview_object_key",   sa.Text()),
        sa.Column("exif_data",            JSONB()),
        sa.Column("hash",                 sa.String(64)),
        sa.Column("text",                 sa.Text()),
        sa.Column("archived_at",          sa.DateTime(timezone=True)),
        sa.Column("deletion_date",        sa.DateTime(timezone=True)),
        sa.Column("objects_processed_at",  sa.DateTime(timezone=True)),
        sa.Column("faces_processed_at",    sa.DateTime(timezone=True)),
        sa.Column("ocr_processed_at",      sa.DateTime(timezone=True)),
        sa.Column("location_label",        sa.Text()),
        sa.Column("location_processed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("object_key", name="uq_media_object_key"),
    )
    op.create_index("ix_media_taken_at",       "media", ["taken_at"])
    op.create_index("ix_media_uploaded_by",    "media", ["uploaded_by"])
    op.create_index("ix_media_hash",           "media", ["hash"])
    op.create_index("ix_media_location_label", "media", ["location_label"])

    op.create_table(
        "deleted_items",
        sa.Column("id",           sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("media_id",     sa.String(36), sa.ForeignKey("media.id"), nullable=False),
        sa.Column("deleted_by",   sa.Integer(),  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deletion_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason",       sa.Text()),
        sa.Column("created_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "libraries",
        sa.Column("id",         sa.String(36), primary_key=True),
        sa.Column("name",       sa.Text(),     nullable=False),
        sa.Column("type",       sa.String(20), nullable=False),
        sa.Column("owner_id",   sa.Integer(),  sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "library_media",
        sa.Column("library_id", sa.String(36), sa.ForeignKey("libraries.id"), primary_key=True),
        sa.Column("media_id",   sa.String(36), sa.ForeignKey("media.id"),     primary_key=True),
        sa.Column("added_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "library_access",
        sa.Column("id",         sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("library_id", sa.String(36), sa.ForeignKey("libraries.id"), nullable=False),
        sa.Column("user_id",    sa.Integer(),  sa.ForeignKey("users.id"),     nullable=False),
        sa.Column("role",       sa.String(20), nullable=False),
        sa.Column("added_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("library_id", "user_id", name="uq_library_access"),
    )

    op.create_table(
        "share_links",
        sa.Column("id",           sa.String(36), primary_key=True),
        sa.Column("library_id",   sa.String(36), sa.ForeignKey("libraries.id"), nullable=False),
        sa.Column("album_id",     sa.String(36)),
        sa.Column("media_ids",    JSONB()),
        sa.Column("created_by",   sa.Integer(),  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at",   sa.DateTime(timezone=True)),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at",   sa.DateTime(timezone=True)),
        sa.Column("created_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "albums",
        sa.Column("id",         sa.String(36), primary_key=True),
        sa.Column("library_id", sa.String(36), sa.ForeignKey("libraries.id"), nullable=False),
        sa.Column("owner_id",   sa.Integer(),  sa.ForeignKey("users.id"),     nullable=False),
        sa.Column("name",       sa.Text(),     nullable=False),
        sa.Column("cover_id",   sa.String(36)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "album_items",
        sa.Column("id",         sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("album_id",   sa.String(36), sa.ForeignKey("albums.id"), nullable=False),
        sa.Column("media_id",   sa.String(36), sa.ForeignKey("media.id"),  nullable=False),
        sa.Column("sort_order", sa.Integer(),  nullable=False, server_default="0"),
        sa.Column("caption",    sa.Text()),
        sa.Column("added_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("album_id", "media_id", name="uq_album_items"),
    )

    op.create_table(
        "album_access",
        sa.Column("id",         sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("album_id",   sa.String(36), sa.ForeignKey("albums.id"), nullable=False),
        sa.Column("user_id",    sa.Integer(),  sa.ForeignKey("users.id"),  nullable=False),
        sa.Column("permission", sa.String(20), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("album_id", "user_id", name="uq_album_access"),
    )

    op.create_table(
        "subjects",
        sa.Column("id",                          sa.String(36), primary_key=True),
        sa.Column("library_id",                  sa.String(36), sa.ForeignKey("libraries.id"), nullable=False),
        sa.Column("type",                        sa.String(20), nullable=False),
        sa.Column("name",                        sa.Text()),
        sa.Column("hidden",                      sa.Boolean(),  nullable=False, server_default="false"),
        sa.Column("pet_class",                   JSONB()),
        sa.Column("cover_media_id",              sa.String(36)),
        sa.Column("representative_detection_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_subjects_library_id", "subjects", ["library_id"])

    op.create_table(
        "subject_detections",
        sa.Column("id",             sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("media_id",       sa.String(36), sa.ForeignKey("media.id"),     nullable=False),
        sa.Column("subject_id",     sa.String(36), sa.ForeignKey("subjects.id")),
        sa.Column("bounding_box",   JSONB(),        nullable=False),
        sa.Column("match_distance", sa.Float()),
        sa.Column("review_needed",  sa.Boolean(),  nullable=False, server_default="false"),
        sa.Column("descriptor",     JSONB()),
        sa.Column("confidence",     sa.Float(),    nullable=False),
        sa.Column("detected_at",    sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_subject_detections_media_id",   "subject_detections", ["media_id"])
    op.create_index("ix_subject_detections_subject_id", "subject_detections", ["subject_id"])

    op.create_table(
        "media_objects",
        sa.Column("id",           sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("media_id",     sa.String(36),  sa.ForeignKey("media.id"), nullable=False),
        sa.Column("class",        sa.String(100), nullable=False),
        sa.Column("confidence",   sa.Float(),     nullable=False),
        sa.Column("bounding_box", JSONB(),         nullable=False),
        sa.Column("detected_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_media_objects_media_id", "media_objects", ["media_id"])

    op.create_table(
        "media_ocr",
        sa.Column("id",           sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("media_id",     sa.String(36), sa.ForeignKey("media.id"), nullable=False, unique=True),
        sa.Column("text",         sa.Text(),     nullable=False),
        sa.Column("confidence",   sa.Float()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "user_favorites",
        sa.Column("user_id",  sa.Integer(),  sa.ForeignKey("users.id"),  primary_key=True),
        sa.Column("media_id", sa.String(36), sa.ForeignKey("media.id"),  primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "user_tags",
        sa.Column("id",         sa.String(36), primary_key=True),
        sa.Column("library_id", sa.String(36), sa.ForeignKey("libraries.id"), nullable=False),
        sa.Column("name",       sa.Text(),     nullable=False),
        sa.Column("color",      sa.String(7)),
        sa.Column("created_by", sa.Integer(),  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "media_tags",
        sa.Column("tag_id",   sa.String(36), sa.ForeignKey("user_tags.id"), primary_key=True),
        sa.Column("media_id", sa.String(36), sa.ForeignKey("media.id"),     primary_key=True),
        sa.Column("added_by", sa.Integer(),  sa.ForeignKey("users.id"),     nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "background_jobs",
        sa.Column("id",           sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("media_id",     sa.String(36), sa.ForeignKey("media.id"), nullable=False),
        sa.Column("type",         sa.String(30), nullable=False),
        sa.Column("status",       sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error",        sa.Text()),
        sa.Column("created_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at",   sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_background_jobs_media_id", "background_jobs", ["media_id"])
    op.create_index("ix_background_jobs_status",   "background_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("background_jobs")
    op.drop_table("media_tags")
    op.drop_table("user_tags")
    op.drop_table("user_favorites")
    op.drop_table("media_ocr")
    op.drop_table("media_objects")
    op.drop_table("subject_detections")
    op.drop_table("subjects")
    op.drop_table("album_access")
    op.drop_table("album_items")
    op.drop_table("albums")
    op.drop_table("share_links")
    op.drop_table("library_access")
    op.drop_table("library_media")
    op.drop_table("libraries")
    op.drop_table("deleted_items")
    op.drop_table("media")
    op.drop_table("users")

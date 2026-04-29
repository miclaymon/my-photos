"""Subject (people & pets) routes."""
import numpy as np
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.subject import DetectionFeedback, Subject, SubjectDetection
from app.models.user import User

router = APIRouter()


class UpdateDetectionBody(BaseModel):
    review_needed: Optional[bool] = None
    subject_id: Optional[str] = None
    set_cover: bool = False  # when True, mark this detection as the subject's representative


class UpdateSubjectBody(BaseModel):
    name: Optional[str] = None
    hidden: Optional[bool] = None
    cover_media_id: Optional[str] = None
    force: bool = False  # when True, skip name-conflict check and allow duplicate names


class MergeSubjectBody(BaseModel):
    merge_subject_id: str
    name: Optional[str] = None  # new name for the surviving (target) subject


_VALID_FEEDBACK = {"confirmed", "not_person", "not_subject", "low_quality", "wrong_person", "sensitive"}


class FeedbackBody(BaseModel):
    feedback_type: str
    correct_subject_id: Optional[str] = None  # used when feedback_type == 'wrong_person'


# ---------------------------------------------------------------------------
# IMPORTANT: static path segment "detections" must come before /{subject_id}
# ---------------------------------------------------------------------------

@router.patch("/detections/{detection_id}")
def update_detection(
    detection_id: int,
    body: UpdateDetectionBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = db.query(SubjectDetection).filter(SubjectDetection.id == detection_id).first()
    if not det:
        raise HTTPException(status_code=404, detail="Detection not found")

    if body.review_needed is not None:
        det.review_needed = body.review_needed
    if body.subject_id is not None:
        det.subject_id = body.subject_id
    if body.set_cover and det.subject_id:
        subject = db.query(Subject).filter(Subject.id == det.subject_id).first()
        if subject:
            subject.representative_detection_id = det.id

    db.commit()
    return {"ok": True}


@router.patch("/{subject_id}")
def update_subject(
    subject_id: str,
    body: UpdateSubjectBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    if body.name is not None:
        if not body.force:
            existing = (
                db.query(Subject)
                .filter(Subject.name == body.name, Subject.id != subject_id)
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Name already in use",
                        "existing_id": existing.id,
                        "existing_name": existing.name,
                    },
                )
        subject.name = body.name
    if body.hidden is not None:
        subject.hidden = body.hidden
    if body.cover_media_id is not None:
        subject.cover_media_id = body.cover_media_id

    db.commit()
    return {"ok": True}


@router.post("/detections/{detection_id}/feedback")
def submit_feedback(
    detection_id: int,
    body: FeedbackBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Record user feedback on a detection and update detection status + subject
    avg_descriptor accordingly.

    - confirmed      → status='confirmed'; recompute subject avg_descriptor
    - wrong_person   → status='rejected'; optionally reassign to correct_subject_id
    - not_person / not_subject / low_quality / sensitive → status='rejected'
    """
    if body.feedback_type not in _VALID_FEEDBACK:
        raise HTTPException(status_code=400, detail=f"Invalid feedback_type. Must be one of: {sorted(_VALID_FEEDBACK)}")

    det = db.query(SubjectDetection).filter(SubjectDetection.id == detection_id).first()
    if not det:
        raise HTTPException(status_code=404, detail="Detection not found")

    # Record the feedback
    feedback = DetectionFeedback(
        detection_id=detection_id,
        user_id=current_user.id,
        feedback_type=body.feedback_type,
        correct_subject_id=body.correct_subject_id,
    )
    db.add(feedback)

    if body.feedback_type == "confirmed":
        det.status = "confirmed"
        det.review_needed = False
        # Recompute avg_descriptor for the subject using all confirmed detections
        if det.subject_id and det.descriptor:
            _recompute_avg_descriptor(db, det.subject_id)

    elif body.feedback_type == "wrong_person" and body.correct_subject_id:
        det.status = "rejected"
        det.review_needed = False
        # Reassign this detection to the correct subject
        old_subject_id = det.subject_id
        det.subject_id = body.correct_subject_id
        det.status = "confirmed"
        # Recompute avg_descriptor for both affected subjects
        if old_subject_id:
            _recompute_avg_descriptor(db, old_subject_id)
        _recompute_avg_descriptor(db, body.correct_subject_id)

    else:
        # not_person, not_subject, low_quality, sensitive, wrong_person without redirect
        det.status = "rejected"
        det.review_needed = False
        # If detached from its subject, update that subject's avg_descriptor
        if det.subject_id and body.feedback_type in ("not_subject", "wrong_person"):
            old_subject_id = det.subject_id
            det.subject_id = None
            _recompute_avg_descriptor(db, old_subject_id)

    db.commit()
    return {"ok": True}


def _recompute_avg_descriptor(db: Session, subject_id: str) -> None:
    """
    Recompute and persist the average face descriptor for a subject from all
    its confirmed detections. Uses numpy for the mean; falls back gracefully if
    numpy isn't available or no confirmed descriptors exist.
    """
    confirmed = (
        db.query(SubjectDetection)
        .filter(
            SubjectDetection.subject_id == subject_id,
            SubjectDetection.status == "confirmed",
            SubjectDetection.descriptor.isnot(None),
        )
        .all()
    )

    if not confirmed:
        db.query(Subject).filter(Subject.id == subject_id).update(
            {Subject.avg_descriptor: None}
        )
        return

    try:
        descriptors = [det.descriptor for det in confirmed if det.descriptor]
        avg = np.mean(np.array(descriptors, dtype=np.float32), axis=0).tolist()
    except Exception:
        return  # leave avg_descriptor unchanged if numpy fails

    db.query(Subject).filter(Subject.id == subject_id).update(
        {Subject.avg_descriptor: avg}
    )


@router.post("/{subject_id}/merge")
def merge_subjects(
    subject_id: str,
    body: MergeSubjectBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.query(Subject).filter(Subject.id == subject_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target subject not found")

    source = db.query(Subject).filter(Subject.id == body.merge_subject_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source subject not found")

    # Optionally rename the surviving subject
    if body.name:
        target.name = body.name

    # Re-point all detections from the source subject to the target
    db.query(SubjectDetection).filter(
        SubjectDetection.subject_id == body.merge_subject_id
    ).update({SubjectDetection.subject_id: subject_id})

    # Recompute avg_descriptor for the surviving subject from all its detections
    _recompute_avg_descriptor(db, subject_id)

    # Delete the source subject
    db.delete(source)
    db.commit()

    return {"ok": True}

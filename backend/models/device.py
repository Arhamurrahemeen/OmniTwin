from datetime import date, datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel


class DeviceCreate(BaseModel):
    device_id: str
    name: str
    location: str
    sensors: list[str]
    description: Optional[str] = None
    source: str = "simulator"
    thresholds: Dict[str, Any] = {}
    status: str = "active"
    asset_type: Optional[str] = None
    plant: Optional[str] = None
    criticality: str = "medium"
    warranty_expiry: Optional[date] = None
    purchase_date: Optional[date] = None
    vendor_name: Optional[str] = None
    vendor_whatsapp: Optional[str] = None
    run_hours: float = 0.0
    run_hours_threshold: int = 500
    last_run_hours_update: Optional[datetime] = None
    contacts: list[dict] = []


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    sensors: Optional[list[str]] = None
    description: Optional[str] = None
    source: Optional[str] = None
    thresholds: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    asset_type: Optional[str] = None
    plant: Optional[str] = None
    criticality: Optional[str] = None
    warranty_expiry: Optional[date] = None
    purchase_date: Optional[date] = None
    vendor_name: Optional[str] = None
    vendor_whatsapp: Optional[str] = None
    run_hours: Optional[float] = None
    run_hours_threshold: Optional[int] = None
    last_run_hours_update: Optional[datetime] = None
    contacts: Optional[list[dict]] = None


class DeviceResponse(BaseModel):
    device_id: str
    name: str
    location: str
    sensors: list[str]
    description: Optional[str] = None
    source: str = "simulator"
    thresholds: Dict[str, Any] = {}
    status: str = "active"
    asset_type: Optional[str] = None
    plant: Optional[str] = None
    criticality: str = "medium"
    warranty_expiry: Optional[date] = None
    purchase_date: Optional[date] = None
    vendor_name: Optional[str] = None
    vendor_whatsapp: Optional[str] = None
    run_hours: float = 0.0
    run_hours_threshold: int = 500
    last_run_hours_update: Optional[datetime] = None
    contacts: list[dict] = []
    created_at: datetime
    updated_at: datetime

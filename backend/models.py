from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Constraints(StrictModel):
    budget: int = Field(default=180000, ge=1, le=100000000)
    deadline_days: int = Field(default=3, ge=1, le=90)
    certified_only: bool = False


class NewCase(StrictModel):
    title: str = Field(default='Network adapters delayed', min_length=3, max_length=120)
    item: str = Field(default='USB-C network adapter', min_length=2, max_length=100)
    quantity: int = Field(default=20, ge=1, le=10000)
    location: str = Field(default='Islamabad · Engineering lab', min_length=2, max_length=120)
    disruption: str = Field(default='Original shipment delayed by 7 days. Lab installation is scheduled in 3 days.', min_length=10, max_length=2000)
    constraints: Constraints = Field(default_factory=Constraints)


class Decision(StrictModel):
    version: int = Field(ge=1)
    action: Literal['approve', 'revise']
    plan_id: str | None = None
    note: str = Field(default='', max_length=2000)
    constraints: Constraints | None = None


class Execute(StrictModel):
    version: int = Field(ge=1)


class Supplier(StrictModel):
    id: str
    name: str
    location: str
    unit_price: int = Field(ge=1)
    shipping: int = Field(ge=0)
    stock: int = Field(ge=0)
    lead_days: int = Field(ge=0)
    certified: bool
    available: bool = True
    evidence_id: str
    evidence: str


class Snapshot(StrictModel):
    source: str
    suppliers: list[Supplier] = Field(max_length=50)


class PurchaseRequest(StrictModel):
    id: str
    idempotency_key: str
    case_id: str
    supplier_id: str
    quantity: int
    total: int
    status: Literal['draft']

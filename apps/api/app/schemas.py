from typing import Literal
from pydantic import BaseModel, Field

CardType = Literal['note','conversation','knowledge','project']
class NoteInput(BaseModel):
    title: str = Field(default='',max_length=300)
    content: str = Field(min_length=1,max_length=2_000_000)
    tags: list[str] = Field(default_factory=list,max_length=50)
    card_type: CardType = 'note'
    color: Literal['lavender','peach','sage','blue','yellow','white'] = 'lavender'

class CardUpdate(BaseModel):
    expected_revision_id: str
    title: str | None = Field(default=None,min_length=1,max_length=300)
    summary: str | None = Field(default=None,max_length=4000)
    content: str | None = Field(default=None,max_length=2_000_000)
    tags: list[str] | None = Field(default=None,max_length=50)
    card_type: CardType | None = None
    source_label: str | None = Field(default=None,max_length=80)
    favorite: bool | None = None
    archived: bool | None = None
    knowledge_status: Literal['draft','unverified','supported','contested','outdated'] | None = None

class ConfirmedMessage(BaseModel):
    role: Literal['user','assistant','system','tool']
    content: str = Field(min_length=1,max_length=2_000_000)

class ImportInput(BaseModel):
    provider: Literal['auto','chatgpt','deepseek','generic'] = 'auto'
    kind: Literal['text','url','json'] = 'text'
    content: str = Field(min_length=1,max_length=24_000_000)
    title: str = Field(default='',max_length=300)
    source_uri: str | None = None
    confirmed_messages: list[ConfirmedMessage] | None = Field(default=None,max_length=10000)

class OptimizeInput(BaseModel):
    card_id: str
    instruction: str = Field(default='整理段落，提炼摘要和标签。保留原有观点与不确定性，不增加事实。',max_length=4000)
    use_ai: bool = False

class AuditInput(BaseModel):
    card_id: str | None = None
    tag: str | None = None
    limit: int = Field(default=500,ge=1,le=10000)

class RevisionProposal(BaseModel):
    title: str = Field(min_length=1,max_length=300)
    summary: str = Field(max_length=4000)
    content: str = Field(min_length=1,max_length=2_000_000)
    tags: list[str] = Field(max_length=50)

class SettingsInput(BaseModel):
    model_base_url: str | None = None
    model: str | None = None
    embedding_model: str | None = None
    allow_cloud: bool | None = None
    api_key: str | None = None
    auto_metadata: bool | None = None
    auto_semantic: bool | None = None
    model_daily_calls: int | None = Field(default=None,ge=1,le=1000)
    model_max_input_chars: int | None = Field(default=None,ge=100,le=32000)
    default_tag: str | None = Field(default=None,max_length=80)
    auto_audit: bool | None = None
    incremental_audit: bool | None = None
    audit_interval_days: int | None = Field(default=None,ge=1,le=365)
    backup_interval_days: int | None = Field(default=None,ge=1,le=30)

class LinkInput(BaseModel):
    target_card_id: str

class EvidenceInput(BaseModel):
    card_id: str
    chunk_id: str
    claim_ref: str = Field(default='',max_length=2000)

class DirectRevisionInput(RevisionProposal):
    expected_revision_id: str
    instruction: str = Field(default='Agent 提交的整理建议',max_length=4000)

class CaptureInput(BaseModel):
    content: str = Field(min_length=1,max_length=24_000_000)

class RegenerateInput(BaseModel):
    field: Literal['title','summary','tags']
    expected_revision_id: str

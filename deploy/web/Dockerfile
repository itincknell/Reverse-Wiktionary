FROM python:3.10-slim AS ipa-to-mespeak-builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir "maturin>=1.7,<2.0"

WORKDIR /build/ipa_to_mespeak
COPY native/ipa_to_mespeak/ ./
RUN maturin build --release --strip --out /wheels \
    && pip install --no-cache-dir --prefix=/install /wheels/*.whl


FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/opt/model-cache/huggingface
ENV SENTENCE_TRANSFORMERS_HOME=/opt/model-cache/sentence-transformers
ARG MODEL_NAME=sentence-transformers/all-mpnet-base-v2
ENV MODEL_NAME=${MODEL_NAME}
ARG TORCH_VERSION=2.12.0+cpu

WORKDIR /app

COPY requirements.txt .
COPY --from=ipa-to-mespeak-builder /install /usr/local
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}" \
    && pip install --no-cache-dir -r requirements.txt
RUN python - <<'PY'
import os

from sentence_transformers import SentenceTransformer

model_name = os.environ["MODEL_NAME"]
if not model_name.startswith("local-preview/dummy-"):
    SentenceTransformer(model_name, device="cpu")
PY

COPY src ./src

EXPOSE 8000

CMD ["uvicorn", "src.web.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

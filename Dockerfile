FROM python:3.12-slim
# Non-root, read-only-rootfs compatible (writable tmp only), no Docker socket ever mounted.
RUN useradd --create-home --shell /usr/sbin/nologin bayora
WORKDIR /app
# Deps FIRST: the pip layer only depends on requirements/pyproject, so code
# changes never invalidate it (offline-reproducible image rebuilds).
COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache
COPY config/ ./config/
COPY scripts/ ./scripts/
COPY app/ ./app/
USER bayora
ENV PYTHONUNBUFFERED=1 BAYORA_OFFLINE=1
# target service only; broker launched in its own container from the same image
CMD ["python", "-m", "uvicorn", "app.target.service:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

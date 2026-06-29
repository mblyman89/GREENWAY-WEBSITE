# Greenway crawler — production image.
# Uses the official Playwright base so Chromium + system deps are preinstalled,
# which is exactly what crawl4ai needs to render JS-heavy pages.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app

# Install Python deps first (better layer caching).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY app ./app

# Non-root for safety.
RUN useradd -m crawler && chown -R crawler:crawler /app
USER crawler

ENV CRAWL_CACHE_DIR=/tmp/greenway-crawl-cache
EXPOSE 8200

# Honor the platform's PORT if provided, else 8200.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${CRAWLER_PORT:-8200}"]

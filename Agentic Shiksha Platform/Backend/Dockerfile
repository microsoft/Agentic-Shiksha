# Ekalaiva/Dockerfile
ARG PYTHON_VERSION=3.13.5
FROM python:${PYTHON_VERSION}-slim AS dependencies

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_PYTHON_DOWNLOADS=never
ENV PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Install system deps: build-essential + poppler + texlive for TikZ diagrams
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    texlive-base \
    texlive-pictures \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-science \
    && rm -rf /var/lib/apt/lists/*

# Poppler binaries (pdftotext, pdftoppm, etc.) live here in Debian/Ubuntu
ENV POPPLER_PATH=/usr/bin

# Install the locked runtime without development tools.
COPY pyproject.toml uv.lock .python-version ./
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" uv==0.12.18 \
    && uv sync --locked --no-dev --no-cache --python /usr/local/bin/python

RUN apt-get update && apt-get install -y --no-install-recommends ngspice \
    && rm -rf /var/lib/apt/lists/*

FROM dependencies AS runtime

# Copy backend code
COPY . .

# Use PORT env variable (Azure sets this), default to 8080
ENV PORT=8080
EXPOSE 8080

CMD uvicorn backend.main:app --host 0.0.0.0 --port $PORT

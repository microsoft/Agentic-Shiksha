# Ekalaiva/Dockerfile
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

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

# Copy and install Python deps
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Use PORT env variable (Azure sets this), default to 8080
ENV PORT=8080
EXPOSE 8080

CMD uvicorn backend.main:app --host 0.0.0.0 --port $PORT

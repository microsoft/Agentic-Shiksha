FROM python:3.11-slim AS dependencies

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH"

# files.pythonhosted.org is TLS-blocked on the corporate network; build through the mirror.
ARG PIP_INDEX_URL=https://packagefeedproxy.microsoft.io/pypi/simple/
ENV PIP_INDEX_URL=$PIP_INDEX_URL

COPY pyproject.toml uv.lock .python-version ./
RUN pip install --no-cache-dir uv==0.12.18 \
    && uv sync --locked --no-dev --no-cache --python /usr/local/bin/python

FROM dependencies AS runtime
COPY . .

EXPOSE 8050

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8050"]

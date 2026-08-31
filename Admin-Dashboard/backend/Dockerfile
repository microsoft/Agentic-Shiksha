FROM python:3.11-slim

WORKDIR /app

# files.pythonhosted.org is TLS-blocked on the corporate network; build through the mirror.
ARG PIP_INDEX_URL=https://packagefeedproxy.microsoft.io/pypi/simple/
ENV PIP_INDEX_URL=$PIP_INDEX_URL

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8050

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8050"]

FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py macro.py ./
COPY static ./static
COPY react-version/static ./react-version/static

# Données persistantes (comptes, clé de session, cache macro) si un volume est monté
VOLUME ["/app/data"]

EXPOSE 8000
ENV PORT=8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--timeout", "90", "server:app"]

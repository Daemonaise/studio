FROM python:3.11-slim

# System deps for pymeshlab / open3d / trimesh
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 libgomp1 libxrender1 libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run injects PORT env var (default 8080)
ENV PORT=8080
# Allow Open3D to run headless
ENV DISPLAY=:0
ENV OPEN3D_CPU_RENDERING=true

CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 900 main:app

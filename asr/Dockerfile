# Autocut speech-to-text on a GPU (NVIDIA, CUDA 12 + cuDNN 9 as CTranslate2 needs).
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /asr
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

ARG ASR_MODEL=large-v3
ENV ASR_MODEL=${ASR_MODEL} ASR_DEVICE=cuda PORT=8000 HF_HOME=/asr/models
# Bake the model into the image so new GPUs start in seconds, not after a download.
RUN python3 -c "from faster_whisper.utils import download_model; download_model('${ASR_MODEL}')"

COPY server.py .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["python3", "server.py"]

# Gunicorn do Vendas Online.
import os

bind = "0.0.0.0:8000"
workers = int(os.environ.get("VENDAS_WORKERS", "2"))
threads = int(os.environ.get("VENDAS_THREADS", "4"))
worker_class = "gthread"
timeout = 30
graceful_timeout = 20
keepalive = 5
# arquivos temporários em memória (a raiz do container é somente leitura)
worker_tmp_dir = "/dev/shm"
accesslog = "-"
errorlog = "-"
# não registra o token dos aparelhos (vai no cabeçalho, não na URL) nem IPs completos de terceiros
access_log_format = '%({x-forwarded-for}i)s "%(r)s" %(s)s %(b)s %(M)sms'
forwarded_allow_ips = "*"

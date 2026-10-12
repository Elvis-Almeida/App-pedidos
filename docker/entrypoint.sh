#!/bin/sh
# Prepara o banco e sobe o gunicorn. Se a preparação falhar, o container cai
# e o Swarm volta para a versão anterior (update_config: failure_action rollback).
set -e
python manage.py preparar
exec gunicorn config.wsgi:application -c /app/gunicorn.conf.py

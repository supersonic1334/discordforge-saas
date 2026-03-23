@echo off
cd /d C:\Users\33675\OneDrive\Bureau\disco\backend
set PUBLIC_PORT=4010
set BACKEND_PORT=4000
node src\publicGateway.js > C:\Users\33675\OneDrive\Bureau\disco\backend\public-gateway.out.log 2> C:\Users\33675\OneDrive\Bureau\disco\backend\public-gateway.err.log

$env:PUBLIC_PORT = '4010'
$env:BACKEND_PORT = '4000'
Set-Location 'C:\Users\33675\OneDrive\Bureau\disco\backend'
node 'src\publicGateway.js' *> 'C:\Users\33675\OneDrive\Bureau\disco\backend\public-gateway.out.log'

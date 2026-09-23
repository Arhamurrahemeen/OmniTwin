# OmniTwin local dev run (native services already installed/running)
# T1: Mosquitto  , T2: InfluxDB 2.7 , T3: MongoDB 7.0  (native, NOT Docker)
# InfluxDB setup values: org=twinlab bucket=twinlab user=admin pwd=twinlab123 token=twinlab-super-secret-token
param([switch]$DashboardOnly)
$py = "D:\OmniTwin\.venv\Scripts\python"

Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "D:\OmniTwin\ingestion.py"
Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "D:\OmniTwin\simulator.py"
if (-not $DashboardOnly) {
  Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "-m","uvicorn","main:app","--reload","--host","0.0.0.0","--port","8000" -WorkingDirectory "D:\OmniTwin\backend"
}
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\frontend"
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\sim-control"
Write-Host "OmniTwin running — dashboard http://localhost:5173  sim-control http://localhost:5174  API http://localhost:8000/docs"

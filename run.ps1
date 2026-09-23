# OmniTwin local dev run (backend + dashboard only — serial twin via Web Serial in the browser)
param()
$py = "D:\OmniTwin\.venv\Scripts\python"
Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "-m","uvicorn","main:app","--reload","--host","0.0.0.0","--port","8000" -WorkingDirectory "D:\OmniTwin\backend"
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\frontend"
Write-Host "OmniTwin running - dashboard http://localhost:5173  API http://localhost:8000 /docs"
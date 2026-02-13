param(
  [int]$Port = 5500
)

Write-Host "Starting local server at http://localhost:$Port/index.html"
python -m http.server $Port

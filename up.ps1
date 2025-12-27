param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$scriptPath = Join-Path $PSScriptRoot "scripts/up.js"
node $scriptPath @Args


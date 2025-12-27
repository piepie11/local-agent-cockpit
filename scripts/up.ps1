param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$scriptPath = Join-Path $PSScriptRoot "up.js"
node $scriptPath @Args


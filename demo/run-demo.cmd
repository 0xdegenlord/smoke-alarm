@echo off
rem Runs the whole Smoke Alarm demo on NEAR testnet in one go (Windows).
rem Usage, from the smoke-alarm folder:   demo\run-demo YOUR-NAME.testnet
rem Needs: the NEAR tool installed, and a testnet account you created yourself.

setlocal
set ACCOUNT=%1
if "%ACCOUNT%"=="" (
  echo Usage: demo\run-demo YOUR-NAME.testnet
  exit /b 1
)

echo.
echo === Starting fresh: forgetting earlier testnet snapshots ===
if exist data-testnet rmdir /s /q data-testnet

echo.
echo === Step 1 of 4: deploying the HONEST token (v1) to %ACCOUNT% ===
call near contract deploy %ACCOUNT% use-file demo\token-v1.wasm without-init-call network-config testnet sign-with-keychain send
if errorlevel 1 goto failed
timeout /t 5 /nobreak >nul
call near contract call-function as-read-only %ACCOUNT% version json-args {} network-config testnet now

echo.
echo === Step 2 of 4: Smoke Alarm takes its first snapshot ===
node src\scan.js --network testnet %ACCOUNT%

echo.
echo === Step 3 of 4: now playing the bad guy, swapping in v2 ===
pause
call near contract deploy %ACCOUNT% use-file demo\token-v2.wasm without-init-call network-config testnet sign-with-keychain send
if errorlevel 1 goto failed
timeout /t 5 /nobreak >nul

echo.
echo === Step 4 of 4: Smoke Alarm checks again ===
node src\scan.js --network testnet %ACCOUNT%

echo.
echo === Proof the rules changed: ===
call near contract call-function as-read-only %ACCOUNT% version json-args {} network-config testnet now
echo.
echo Done. Look for [CRITICAL] in Step 4 above.
exit /b 0

:failed
echo.
echo A deploy failed. Read the error above, then see DEMO.md.
exit /b 1

@echo off

:: 1. Set deployment target directory
IF NOT DEFINED DEPLOYMENT_TARGET (
  SET DEPLOYMENT_TARGET=%DEPLOYMENT_TARGET%\site\wwwroot
)

:: 2. Copy all files to deployment target
echo Copying files to deployment target...
xcopy /Y /E /I . "%DEPLOYMENT_TARGET%"

:: 3. Install npm packages
IF EXIST "%DEPLOYMENT_TARGET%\package.json" (
  pushd "%DEPLOYMENT_TARGET%"
  call npm install --production
  IF !ERRORLEVEL! NEQ 0 goto error
  popd
)

:: 4. Start the application
pushd "%DEPLOYMENT_TARGET%"
call npm start
popd

:error
echo An error has occurred during web site deployment.
exit /b 1 
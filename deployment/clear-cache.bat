@echo off
echo Clearing IIS cache and restarting application...

REM Stop application pool (if needed)
%windir%\system32\inetsrv\appcmd stop apppool /apppool.name:"DefaultAppPool" || echo App pool not running

REM Clear temporary ASP.NET files
rmdir /s /q %SystemRoot%\Microsoft.NET\Framework\v4.0.30319\Temporary ASP.NET Files\* 2>nul
rmdir /s /q %SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\Temporary ASP.NET Files\* 2>nul

REM Clear IIS cache
%windir%\system32\inetsrv\appcmd.exe clear config /section:staticContent
%windir%\system32\inetsrv\appcmd.exe clear config /section:caching

REM Restart application pool 
%windir%\system32\inetsrv\appcmd start apppool /apppool.name:"DefaultAppPool"

REM Update the "lastDeployment" timestamp file
echo %date% %time% > lastDeployment.txt

echo Cache clearing complete 
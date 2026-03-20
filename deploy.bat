@echo off
cd /d D:\daengdaengroad-server
echo 서버 파일 배포 중...
git add .
git commit -m "업데이트"
git push
echo.
echo 배포 완료! Railway에서 자동 재배포됩니다.
pause

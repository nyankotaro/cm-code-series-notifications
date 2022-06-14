#!/bin/bash
yum update -y
yum install -y httpd
systemctl enable httpd
systemctl start httpd
yum install -y ruby
yum install -y wget
wget https://aws-codedeploy-ap-northeast-1.s3.ap-northeast-1.amazonaws.com/latest/install
chmod +x ./install
./install auto
systemctl start codedeploy-agent
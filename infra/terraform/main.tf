# WOW Artwork Engine — AWS infrastructure REFERENCE (Build Plan M0 · infra).
#
# NOTE: production does NOT provision a new standalone stack. The engine deploys
# into WOW's EXISTING AWS account (Shawn-managed) alongside the live Content
# Automation pipeline: the shared EC2 app servers (staging + production, via
# PM2 — see infra/pm2 and .github/workflows/*-deploy.yml), the shared Postgres,
# and the WOW asset bucket. This file is kept only as a reference for the
# resource shapes and for any future dedicated environment; it is NOT applied
# as-is. Prefer reusing the existing resources (set DATABASE_URL, S3_BUCKET,
# and Secrets Manager ids in the environment) over `terraform apply` here.
#
#   terraform init && terraform plan -var-file=prod.tfvars   # reference only

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "region" {
  type    = string
  default = "us-west-2"
}

variable "project" {
  type    = string
  default = "wow-artwork-engine"
}

variable "db_password" {
  type      = string
  sensitive = true
}

provider "aws" {
  region = var.region
}

# ---- Object storage for raw + processed media ----
resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---- Postgres metadata store ----
resource "aws_db_instance" "postgres" {
  identifier             = "${var.project}-db"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  db_name                = "wow_artwork"
  username               = "postgres"
  password               = var.db_password
  skip_final_snapshot    = true
  publicly_accessible    = false
  # TODO: attach to a private subnet group + security group.
}

# ---- App server (FFmpeg jobs + Express + PM2) ----
resource "aws_instance" "app" {
  ami           = "ami-0abcdef1234567890" # TODO: pin a current Ubuntu LTS AMI
  instance_type = "t3.small"
  tags = {
    Name    = "${var.project}-app"
    Project = var.project
  }
  # TODO: IAM instance profile granting S3 + Secrets Manager access,
  #       security group, key pair, user_data to install Node + FFmpeg + PM2.
}

# ---- Secrets (FTP creds, API keys) ----
resource "aws_secretsmanager_secret" "app" {
  name = "${var.project}/app"
}

output "s3_bucket" {
  value = aws_s3_bucket.assets.bucket
}

output "db_endpoint" {
  value = aws_db_instance.postgres.address
}

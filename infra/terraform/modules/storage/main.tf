variable "environment" { type = string }
variable "kms_key_arn" { type = string }

resource "aws_s3_bucket" "uploads" {
  bucket = "operza-${var.environment}-uploads"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "quarantine-expiry"
    status = "Enabled"
    filter { prefix = "quarantine/" }
    expiration { days = 7 }
  }
}

output "uploads_bucket_name" { value = aws_s3_bucket.uploads.bucket }
output "uploads_bucket_arn" { value = aws_s3_bucket.uploads.arn }

variable "environment" { type = string }
variable "domain_name" { type = string }

# ACM certificate definition (validation records must be approved in Route 53 / DNS)
resource "aws_acm_certificate" "this" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

output "acm_certificate_arn" { value = aws_acm_certificate.this.arn }

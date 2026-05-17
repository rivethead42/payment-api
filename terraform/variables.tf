variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the demo VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "cluster_version" {
  description = "EKS Kubernetes version. Bump when AWS publishes newer EKS versions (e.g. 1.36)."
  type        = string
  default     = "1.35"
}

variable "cluster_admin_principal_arns" {
  description = "Additional IAM principal ARNs granted EKS cluster admin via access entries."
  type        = list(string)
  default     = []
}

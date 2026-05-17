variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the EKS cluster."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for managed node groups."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the EKS control plane."
  type        = list(string)
}

variable "cluster_admin_principal_arns" {
  description = "Additional IAM principal ARNs granted cluster admin."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to EKS-related resources."
  type        = map(string)
  default     = {}
}

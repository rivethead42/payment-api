variable "repository_name" {
  description = "ECR repository name."
  type        = string
}

variable "tags" {
  description = "Tags applied to ECR resources."
  type        = map(string)
  default     = {}
}

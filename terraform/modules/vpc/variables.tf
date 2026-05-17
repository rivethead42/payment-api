variable "name" {
  description = "Name prefix for VPC resources."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "tags" {
  description = "Tags applied to VPC resources."
  type        = map(string)
  default     = {}
}

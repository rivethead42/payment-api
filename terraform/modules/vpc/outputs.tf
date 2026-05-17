output "vpc_id" {
  description = "VPC ID."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs for EKS nodes."
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs for load balancers and cluster control plane."
  value       = module.vpc.public_subnets
}

output "azs" {
  description = "Availability zones used by the VPC."
  value       = local.azs
}

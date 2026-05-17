output "eks_cluster_name" {
  description = "EKS cluster name for kubectl and aws eks commands."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API server endpoint URL."
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_certificate_authority_data" {
  description = "Base64-encoded certificate authority data for kubeconfig."
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "update_kubeconfig_command" {
  description = "Shell command to configure kubectl for this cluster."
  value       = "aws eks update-kubeconfig --region ${data.aws_region.current.name} --name ${module.eks.cluster_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL for CI/CD image push."
  value       = module.ecr.repository_url
}

export declare function licensePolicyViolations(paths: string[]): string[]

export declare function checkLicensePolicy(root?: string): {
  checked: number
  licenseFiles: number
}

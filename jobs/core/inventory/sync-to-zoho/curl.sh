curl --request POST 'https://accounts.zoho.com/oauth/v2/token' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'code=1000.85abdfab6aa0fbf1d497c9411527cb34.e82956ab5dc865c18f09efc2aa02bba0' \
  --data-urlencode 'client_id=1000.D05KJOQNMW84LYGCZCTLYSTJ0RHEJH' \
  --data-urlencode 'client_secret=dff03974cd490efe4e7f44252690eb8544671f4759' \
  --data-urlencode 'redirect_uri=http://localhost'


# access token
1000.b57f95b553d48066385eee6464092e82.b3039fc0d13bce85acd7405bb5285c83

# refreh token
1000.784af388e33bef2a9de4248e61e26e8d.e7b906713ab7241cc861bdfd7d327dca

curl --request POST 'https://accounts.zoho.com/oauth/v2/token' \
  --data-urlencode 'refresh_token=1000.784af388e33bef2a9de4248e61e26e8d.e7b906713ab7241cc861bdfd7d327dca' \
  --data-urlencode 'client_id=1000.D05KJOQNMW84LYGCZCTLYSTJ0RHEJH' \
  --data-urlencode 'client_secret=dff03974cd490efe4e7f44252690eb8544671f4759' \
  --data-urlencode 'grant_type=refresh_token'

# final access token
1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d

# organization id


$ curl https://www.zohoapis.com/inventory/v1/organizations?authtoken=1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d

curl --request GET 'https://www.zohoapis.com/inventory/v1/organizations' \
  --header 'Authorization: Zoho-oauthtoken 1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d'

# Get all items
curl --request GET 'https://www.zohoapis.com/inventory/v1/items?organization_id=891983668&page=1&per_page=100' \
  --header 'Authorization: Zoho-oauthtoken 1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d'

# Get items with specific sku
curl --request GET 'https://www.zohoapis.com/inventory/v1/items?organization_id=891983668&sku=soft-granite-white' \
  --header 'Authorization: Zoho-oauthtoken 1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d'

# Get stock adjustments
curl --request GET 'https://www.zohoapis.com/inventory/v1/stockadjustments?organization_id=891983668' \
  --header 'Authorization: Zoho-oauthtoken 1000.12ee195909126be39187ad0d64decc4f.c4fcfd1902ab4103f9beaab0570a454d'

#realm id
9341454942706100

curl --request GET \
  --url 'https://sandbox-quickbooks.api.intuit.com/v3/company/9341454942706100/query?query=SELECT%20*%20FROM%20Invoice%20WHERE%20DocNumber%20%3D%20%271039%27' \
  --header 'Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwieC5vcmciOiJIMCJ9..h0g0Lq6CsKyYOLke-QhsWw.f9ioGU3ReqoJn7r54sxzqVYS6iTmLeoAOSPaH4KGu5t9qYsiqBiLwf-6vFwQEnJlo-t6DXAPpIp0WE-GWxHaNhFC3iCt6uQf1f8g9FoFFFLm4uKEz-fFGlmAWOLtZl1A1ze3PUJRutyFBM3cENaQ4lDJ34msx5DaOlMTlDfhxaj7akoUI5fTtspY0BoxaIh0KqzBs70L0F1zxFrSBtnqt2-1hTC9yk_aJ5BUQPEKJypDGZb8KaZ_898R8lH4E5XmC--9BTbBlIRAHGPJB3lPnVVG1cvNm7h6WzkFs2SCWCL1UjTu6PJOLfPiOPXVyMT7z9S93J778mRLT8ctqJ_bMmhExWGn7NIqXtovqQMVtq7Ek3JGHapC9stj1N0V0kV3I12HxOIoxl1GxTdCIjESbH58FsM498LUPJ9a83EjN3llIkGrd_NchHZPiDKd_Y-QMdlJYUXNhsCqLe6h__b7Cg.IBf0Sd1Dz_AYmVTUxI4YlQ' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/text'


curl --request POST \
  --url 'https://sandbox-quickbooks.api.intuit.com/v3/company/9341454942706100/invoice?operation=update' \
  --header 'Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwieC5vcmciOiJIMCJ9..h0g0Lq6CsKyYOLke-QhsWw.f9ioGU3ReqoJn7r54sxzqVYS6iTmLeoAOSPaH4KGu5t9qYsiqBiLwf-6vFwQEnJlo-t6DXAPpIp0WE-GWxHaNhFC3iCt6uQf1f8g9FoFFFLm4uKEz-fFGlmAWOLtZl1A1ze3PUJRutyFBM3cENaQ4lDJ34msx5DaOlMTlDfhxaj7akoUI5fTtspY0BoxaIh0KqzBs70L0F1zxFrSBtnqt2-1hTC9yk_aJ5BUQPEKJypDGZb8KaZ_898R8lH4E5XmC--9BTbBlIRAHGPJB3lPnVVG1cvNm7h6WzkFs2SCWCL1UjTu6PJOLfPiOPXVyMT7z9S93J778mRLT8ctqJ_bMmhExWGn7NIqXtovqQMVtq7Ek3JGHapC9stj1N0V0kV3I12HxOIoxl1GxTdCIjESbH58FsM498LUPJ9a83EjN3llIkGrd_NchHZPiDKd_Y-QMdlJYUXNhsCqLe6h__b7Cg.IBf0Sd1Dz_AYmVTUxI4YlQ' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data '{
    "Id": "147",
    "SyncToken": "0",
    "sparse": true,
    "TxnDate": "2025-07-02"
  }'

invoice.Id,
invoice.SyncToken,


import axios from 'axios'; // Or any other HTTP client library

async function makeMultipleRequests() {
    try {
        const [response1, response2, response3] = await Promise.all([
            axios.post('http://localhost:3000/api/v1/razorpay/verifyPayment', 
            {"entity":"event","account_id":"acc_KjMnKO3Hy4wJMo","event":"payment.captured","contains":["payment"],"payload":{"payment":{"entity":{"id":"pay_QbOzXab1C7lUNA","entity":"payment","amount":19900,"currency":"INR","status":"captured","order_id":"2ff906bd-b605-41e4-8d29-e81e5683044c","invoice_id":null,"international":false,"method":"upi","amount_refunded":0,"refund_status":null,"captured":false,"description":"Payment for Vitraag Vigyaan Aashray","card_id":null,"bank":null,"wallet":null,"vpa":"success@razorpay","email":"ajain0184@gmail.com","contact":"+14045392459","notes":{"app":"aashray","env":"prod"},"fee":48,"tax":8,"error_code":null,"error_description":null,"error_source":null,"error_step":null,"error_reason":null,"acquirer_data":{"rrn":"106355056983","upi_transaction_id":"61B6E77DC89EF08BFF09BC1DB4E831AF"},"created_at":1748665248,"reward":null,"upi":{"vpa":"success@razorpay"},"base_amount":19900}}},"created_at":1748665249}
            ),
            axios.post('http://localhost:3000/api/v1/razorpay/verifyPayment', 
            {"entity":"event","account_id":"acc_KjMnKO3Hy4wJMo","event":"payment.authorized","contains":["payment"],"payload":{"payment":{"entity":{"id":"pay_QbOzXab1C7lUNA","entity":"payment","amount":19900,"currency":"INR","status":"authorized","order_id":"2ff906bd-b605-41e4-8d29-e81e5683044c","invoice_id":null,"international":false,"method":"upi","amount_refunded":0,"refund_status":null,"captured":false,"description":"Payment for Vitraag Vigyaan Aashray","card_id":null,"bank":null,"wallet":null,"vpa":"success@razorpay","email":"ajain0184@gmail.com","contact":"+14045392459","notes":{"app":"aashray","env":"prod"},"fee":48,"tax":8,"error_code":null,"error_description":null,"error_source":null,"error_step":null,"error_reason":null,"acquirer_data":{"rrn":"106355056983","upi_transaction_id":"61B6E77DC89EF08BFF09BC1DB4E831AF"},"created_at":1748665248,"reward":null,"upi":{"vpa":"success@razorpay"},"base_amount":19900}}},"created_at":1748665249}
            ),
        ]);

        console.log('Response from data1:', response1.data);
        console.log('Response from data2:', response2.data);
        // console.log('Response from data3:', response3.data);

    } catch (error) {
        console.error('Error during requests:', error);
    }
}

makeMultipleRequests();
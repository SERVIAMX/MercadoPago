// ─────────────────────────────────────────────────────────
// DEPENDENCIA en pubspec.yaml:
//   webview_flutter: ^4.10.0
// ─────────────────────────────────────────────────────────

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class PaymentResult {
  final String orderId;
  final String paymentId;
  final String status;
  final String paymentStatus;
  final String paymentStatusDetail;
  final String totalAmount;
  final String externalReference;
  final String userId;

  PaymentResult({
    required this.orderId,
    required this.paymentId,
    required this.status,
    required this.paymentStatus,
    required this.paymentStatusDetail,
    required this.totalAmount,
    required this.externalReference,
    required this.userId,
  });

  bool get isApproved => status == 'processed' && paymentStatusDetail == 'accredited';

  factory PaymentResult.fromJson(Map<String, dynamic> json) {
    return PaymentResult(
      orderId:             json['order_id']              ?? '',
      paymentId:           json['payment_id']            ?? '',
      status:              json['status']                ?? '',
      paymentStatus:       json['payment_status']        ?? '',
      paymentStatusDetail: json['payment_status_detail'] ?? '',
      totalAmount:         json['total_amount']          ?? '',
      externalReference:   json['external_reference']   ?? '',
      userId:              json['user_id']               ?? '',
    );
  }
}

class MercadoPagoCheckoutPage extends StatefulWidget {
  final String userId;          // Tu ID interno del usuario
  final double amount;          // Monto a cobrar
  final String? externalReference; // Referencia de tu orden (opcional)
  final void Function(PaymentResult result) onPaymentResult;

  const MercadoPagoCheckoutPage({
    super.key,
    required this.userId,
    required this.amount,
    required this.onPaymentResult,
    this.externalReference,
  });

  @override
  State<MercadoPagoCheckoutPage> createState() => _MercadoPagoCheckoutPageState();
}

class _MercadoPagoCheckoutPageState extends State<MercadoPagoCheckoutPage> {
  late final WebViewController _controller;
  bool _loading = true;

  // ⚠️ Cambiar por tu URL de producción en producción
  static const String _baseUrl = 'http://10.0.2.2:3001'; // 10.0.2.2 = localhost desde emulador Android

  @override
  void initState() {
    super.initState();

    final ref = widget.externalReference ?? 'orden-${DateTime.now().millisecondsSinceEpoch}';
    final url = Uri.parse(
      '$_baseUrl/checkout.html'
      '?user_id=${Uri.encodeComponent(widget.userId)}'
      '&ref=${Uri.encodeComponent(ref)}'
      '&amount=${widget.amount.toStringAsFixed(2)}',
    );

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)

      // Canal para recibir el resultado del pago desde el HTML
      ..addJavaScriptChannel(
        'FlutterChannel',
        onMessageReceived: (JavaScriptMessage message) {
          final Map<String, dynamic> json = jsonDecode(message.message);
          final result = PaymentResult.fromJson(json);
          widget.onPaymentResult(result);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) => setState(() => _loading = false),
        ),
      )
      ..loadRequest(url);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pago con tarjeta')),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────
// CÓMO USARLO desde cualquier pantalla de Flutter:
// ─────────────────────────────────────────────────────────

class EjemploUsoPago extends StatelessWidget {
  const EjemploUsoPago({super.key});

  void _abrirPago(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => MercadoPagoCheckoutPage(
          userId: 'user-123',           // <-- tu ID de usuario logueado
          amount: 150.00,              // <-- monto dinámico
          externalReference: 'orden-abc-456', // <-- tu ID de orden
          onPaymentResult: (result) {
            Navigator.pop(context);   // cerrar el checkout

            if (result.isApproved) {
              // ✅ Pago aprobado — acreditar producto
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('¡Pago aprobado! Orden: ${result.orderId}')),
              );

              // Aquí llamas a tu lógica de negocio:
              // - acreditar recarga
              // - navegar a pantalla de éxito
              // - etc.
            } else {
              // ❌ Pago rechazado
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Pago rechazado: ${result.paymentStatusDetail}'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => _abrirPago(context),
          child: const Text('Pagar \$150.00 MXN'),
        ),
      ),
    );
  }
}
